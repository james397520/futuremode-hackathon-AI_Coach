#!/bin/bash
cd "$(dirname "$0")"
PORT="${1:-8000}"

# 若該 port 已有伺服器在跑,直接使用,不重複啟動
if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "伺服器已在跑:http://localhost:$PORT"
  exit 0
fi

echo "啟動:http://localhost:$PORT"
python3 -m http.server "$PORT" --directory public
