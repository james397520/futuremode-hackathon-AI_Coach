"""Interactive training loop using the existing local model adapter."""
import time
from app.local_model import build_test_request, parse_test_response, create_test_ai_provider
from app.service import CoachService
from app.sessions import TrainingSessions


def show_evaluation(state):
    latest = state["latest_evaluation"]
    if latest:
        print(f"\n第 {latest['turn']} 輪暫評：")
        for score in latest["report"]["scores"]:
            value = score["score"] if score["score"] is not None else "未觀察"
            print(f"  {score['dimension']}：{value}")
    elif state["evaluations"]:
        print("評估狀態：", state["evaluations"][-1]["status"])


def main():
    sessions = TrainingSessions(CoachService(ai=create_test_ai_provider()))
    sid = sessions.create()["id"]
    print("AI Coach：直接輸入對話；/score 查看背景評分；/finish 或 exit 結束並產生總評。")
    print("使用既有知識庫，不會自動加入範例手冊。")
    try:
        while True:
            message = input("\n學員：").strip()
            if not message:
                continue
            if message in {"/finish", "exit", "quit", "q"}:
                if not sessions.get(sid)["turns"]:
                    break
                sessions.finish(sid)
                print("正在產生最終報告……")
                while sessions.get(sid)["status"] == "finishing":
                    time.sleep(0.5)
                state = sessions.get(sid)
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
