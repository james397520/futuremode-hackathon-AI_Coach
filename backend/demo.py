"""Interactive training loop using the existing local model adapter."""
import time
import argparse
import os
from app.local_model import build_test_request, parse_test_response, create_test_ai_provider
from app.service import CoachService
from app.sessions import TrainingSessions
from app.recordings import save_recording


def show_evaluation(state):
    emotion = state.get("latest_emotion")
    if emotion:
        analysis = emotion["analysis"]
        print(f"第 {emotion['turn']} 輪學員文字語氣：{analysis['label']}（{analysis['intensity']}）")
        print("  依據：", analysis["evidence_quote"] or "不足")
        print("  說明：", analysis["reason"])
        print("  建議：", analysis["suggestion"])
    for item in state.get("emotions", []):
        if item["status"] == "failed":
            print(f"第 {item['turn']} 輪情緒分析失敗：{item['error']}")
    pending_emotions = [str(e["turn"]) for e in state.get("emotions", []) if e["status"] == "pending"]
    if pending_emotions:
        print("情緒分析等待中（回合）：", ", ".join(pending_emotions))
    evaluations = state["evaluations"]
    pending = [e["turn"] for e in evaluations if e["status"] == "pending"]
    failed = [e for e in evaluations if e["status"] == "failed"]
    if pending:
        print("背景評估等待中（回合）：", ", ".join(map(str, pending)))
    for item in failed:
        print(f"第 {item['turn']} 輪評估失敗：{item['error']}")
    latest = state["latest_evaluation"]
    if latest:
        print(f"\n最近成功的暫評：第 {latest['turn']} 輪（目前共 {len(evaluations)} 輪）")
        for score in latest["report"]["scores"]:
            value = score["score"] if score["score"] is not None else "未觀察"
            print(f"  {score['dimension']}：{value}")
            if score["score"] is None:
                print(f"    原因：{score['reason']}")
    elif not evaluations:
        print("尚未開始評估。")


def main():
    parser = argparse.ArgumentParser(description="虛構客戶對練")
    parser.add_argument("--persona", choices=["cautious", "aggressive"], default="cautious")
    parser.add_argument("--model", default=os.getenv("OLLAMA_MODEL", "qwen3:8b"))
    args = parser.parse_args()
    os.environ["OLLAMA_MODEL"] = args.model
    sessions = TrainingSessions(CoachService(ai=create_test_ai_provider()))
    sid = sessions.create(args.persona)["id"]
    print(f"角色：{args.persona}｜模型：{args.model}（LLM 自由對話，持續附帶固定人設）")
    print("AI Coach：直接輸入對話；/score 查看背景評分；/finish 或 exit 結束、產生總評並儲存紀錄。")
    print("使用既有知識庫，不會自動加入範例手冊。")
    try:
        while True:
            message = input("\n學員：").strip()
            if not message:
                continue
            if message in {"/finish", "exit", "quit", "q"}:
                if not sessions.get(sid)["turns"]:
                    break
                # Save the transcript first, so a failed/interrupted final evaluation cannot lose it.
                try:
                    path = save_recording(sessions.get(sid), args.model)
                    print("對話已先儲存：", path)
                except OSError as exc:
                    print("對話儲存失敗：", exc)
                sessions.finish(sid)
                print("正在產生最終報告……")
                while sessions.get(sid)["status"] == "finishing":
                    time.sleep(0.5)
                sessions.close()  # Include all remaining per-turn evaluation outcomes in the recording.
                state = sessions.get(sid)
                try:
                    path = save_recording(state, args.model)
                    print("完整紀錄已儲存：", path)
                except OSError as exc:
                    print("完整紀錄更新失敗（若先前暫存成功，原對話檔仍保留）：", exc)
                report = state["final_report"]
                if report:
                    print(report["summary"])
                    for score in report["scores"]:
                        print(f"{score['dimension']}：{score['score']} — {score['reason']}")
                    print("改善建議：", "；".join(report["improvements"]))
                else:
                    print(state["final_error"])
                break
            if message == "/score":
                show_evaluation(sessions.get(sid))
                continue
            try:
                reply = sessions.turn(sid, message)
                print("AI 客戶：", reply["answer"])
                print("文件狀態：", reply["evidence_status"])
                for flag in reply["compliance"]:
                    print("⚠️", flag["category"], flag["quote"])
                show_evaluation(sessions.get(sid))
            except Exception as exc:
                print("本輪未完成：", exc)
    except (KeyboardInterrupt, EOFError):
        print("\n已離開，未要求最終報告。")
    finally:
        sessions.close()


if __name__ == "__main__":
    main()
