// mac-voices — list the speech voices this Mac can actually use, with quality tier.
//
// `say -v '?'` hides the one thing that matters for how a voice sounds: whether
// the compact, enhanced or premium build is installed. This asks AVFoundation
// directly. Siri's own voices never appear here — Apple does not expose them to
// third parties — so a great-sounding Siri is not evidence a voice is available.
import AVFoundation
import Foundation

let tier: [AVSpeechSynthesisVoiceQuality: String] = [
    .default: "compact", .enhanced: "enhanced", .premium: "premium",
]
let wanted = CommandLine.arguments.dropFirst().first ?? "zh"
let voices = AVSpeechSynthesisVoice.speechVoices()
    .filter { wanted == "all" || $0.language.hasPrefix(wanted) }
    .sorted { ($0.language, $0.name) < ($1.language, $1.name) }

print(String(format: "%-7@ %-14@ %-9@ %@", "lang", "name", "quality", "identifier"))
for v in voices {
    print(String(format: "%-7@ %-14@ %-9@ %@", v.language, v.name, tier[v.quality] ?? "?", v.identifier))
}
let all = AVSpeechSynthesisVoice.speechVoices()
let counts = Dictionary(grouping: all, by: { $0.quality }).mapValues { $0.count }
print("\ninstalled overall: compact=\(counts[.default] ?? 0) enhanced=\(counts[.enhanced] ?? 0) premium=\(counts[.premium] ?? 0)")
if (counts[.enhanced] ?? 0) + (counts[.premium] ?? 0) == 0 {
    print("no enhanced/premium voices installed → System Settings › Accessibility › Spoken Content › System Voice › Manage Voices…")
}
