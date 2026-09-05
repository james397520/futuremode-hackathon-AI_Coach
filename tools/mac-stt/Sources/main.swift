// mac-stt — macOS-native speech-to-text as a tiny CLI, so the API can call it
// like any other provider.
//
//   mac-stt --probe [--locale zh-TW]           -> capability JSON
//   mac-stt --file a.wav --locale zh-TW [--on-device]  -> transcript JSON
//
// Why a CLI and not a Python binding: Speech.framework is Objective-C/Swift
// only and gated by TCC; a separate binary keeps the permission surface and the
// crash surface out of the API process. Audio never leaves the machine when
// `--on-device` is set (the default), which is the whole point of this path.
//
// Input formats are whatever AVFoundation decodes (wav/caf/m4a/mp3/aiff). The
// browser records Opus-in-WebM, which it does not; the Python side transcodes
// with ffmpeg before calling this.

import AVFoundation
import Foundation
import Speech

struct Args {
    var probe = false
    var serve = false
    var port: UInt16 = 8790
    var file: String?
    var locale = "zh-TW"
    var onDevice = true
}

func parse() -> Args {
    var a = Args()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = it.next() {
        switch arg {
        case "--probe": a.probe = true
        case "--serve": a.serve = true
        case "--port": a.port = UInt16(it.next() ?? "") ?? a.port
        case "--file": a.file = it.next()
        case "--locale": a.locale = it.next() ?? a.locale
        case "--on-device": a.onDevice = true
        case "--allow-server": a.onDevice = false
        default: break
        }
    }
    return a
}

func emit(_ obj: [String: Any], exit code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(code)
}

/// Ask TCC once; the answer is cached by the system afterwards.
///
/// The completion is delivered on the main queue, so blocking the main thread
/// on a semaphore would deadlock. Spin the run loop instead, with a deadline.
func authorize() -> SFSpeechRecognizerAuthorizationStatus {
    let current = SFSpeechRecognizer.authorizationStatus()
    if current != .notDetermined { return current }
    var result = current
    var done = false
    SFSpeechRecognizer.requestAuthorization { s in result = s; done = true }
    let deadline = Date().addingTimeInterval(60)
    while !done && Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.1))
    }
    return result
}

func statusName(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
}

let args = parse()

func probeInfo(_ locale: String) -> [String: Any] {
    let rec = SFSpeechRecognizer(locale: Locale(identifier: locale))
    return [
        "locale": locale,
        "available": rec?.isAvailable ?? false,
        "onDevice": rec?.supportsOnDeviceRecognition ?? false,
        "authorization": statusName(authorize()),
        "supportedZh": SFSpeechRecognizer.supportedLocales().map { $0.identifier }.filter { $0.hasPrefix("zh") }.sorted(),
    ]
}

/// Recognise one file. Returns either {"text":..} or {"error":..,"code":..}.
func recognize(path: String, locale: String, onDevice: Bool) -> [String: Any] {
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: locale)), rec.isAvailable else {
        return ["error": "recognizer unavailable for \(locale)", "code": 3]
    }
    let auth = authorize()
    guard auth == .authorized else {
        return ["error": "speech recognition not authorized: \(statusName(auth))",
                "hint": "System Settings → Privacy & Security → Speech Recognition", "code": 4]
    }
    if onDevice && !rec.supportsOnDeviceRecognition {
        return ["error": "on-device recognition not supported for \(locale); install the dictation language or pass --allow-server", "code": 5]
    }
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    request.requiresOnDeviceRecognition = onDevice
    request.shouldReportPartialResults = false
    if #available(macOS 13, *) { request.addsPunctuation = true }

    let started = Date()
    var transcript: String?
    var failure: String?
    rec.recognitionTask(with: request) { result, error in
        if let error = error { failure = error.localizedDescription; return }
        guard let result = result, result.isFinal else { return }
        transcript = result.bestTranscription.formattedString
    }
    // An utterance is seconds long; a minute means the engine is stuck, not slow.
    let deadline = Date().addingTimeInterval(60)
    while transcript == nil && failure == nil && Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    if let f = failure { return ["error": f, "code": 7] }
    guard let text = transcript else { return ["error": "recognition timed out", "code": 6] }
    return ["text": text, "locale": locale, "onDevice": onDevice,
            "durationMs": Int(Date().timeIntervalSince(started) * 1000)]
}

func writeLine(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

if args.probe {
    emit(probeInfo(args.locale))
}

/// Minimal line-oriented TCP server on 127.0.0.1. One JSON request per line,
/// one JSON reply per line, connection kept open. BSD sockets rather than
/// Network.framework: a dozen lines, no callbacks, and recognition already has
/// to pump the main run loop, which a blocking accept loop coexists with.
func serve(port: UInt16, locale: String, onDevice: Bool) -> Never {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { emit(["error": "socket() failed"], exit: 10) }
    var yes: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")   // loopback only, never 0.0.0.0
    let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    guard bound == 0, listen(fd, 8) == 0 else { emit(["error": "bind/listen failed on 127.0.0.1:\(port)"], exit: 11) }
    writeLine(["ready": true, "pid": Int(getpid()), "port": Int(port), "probe": probeInfo(locale)])

    while true {
        let client = accept(fd, nil, nil)
        if client < 0 { continue }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        readLoop: while true {
            let n = read(client, &chunk, chunk.count)
            if n <= 0 { break }
            buffer.append(contentsOf: chunk[0..<n])
            while let nl = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer.subdata(in: 0..<nl)
                buffer.removeSubrange(0...nl)
                var out: [String: Any]
                if let req = (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any] {
                    let id = req["id"] ?? NSNull()
                    if req["probe"] as? Bool == true {
                        out = probeInfo((req["locale"] as? String) ?? locale)
                    } else if let file = req["file"] as? String {
                        out = recognize(path: file,
                                        locale: (req["locale"] as? String) ?? locale,
                                        onDevice: (req["onDevice"] as? Bool) ?? onDevice)
                    } else {
                        out = ["error": "missing file", "code": 2]
                    }
                    out["id"] = id
                } else {
                    out = ["error": "bad request json", "code": 2]
                }
                let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]) + "\n".data(using: .utf8)!
                _ = data.withUnsafeBytes { write(client, $0.baseAddress, data.count) }
            }
        }
        close(client)
    }
}

if args.serve {
    serve(port: args.port, locale: args.locale, onDevice: args.onDevice)
}

guard let path = args.file else {
    emit(["error": "usage: mac-stt --probe | --serve | --file <audio> [--locale zh-TW] [--on-device|--allow-server]"], exit: 2)
}
let out = recognize(path: path, locale: args.locale, onDevice: args.onDevice)
emit(out, exit: Int32((out["code"] as? Int) ?? 0))
