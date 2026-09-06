"""MiniMax direct and GMI Cloud adapter contracts."""

from __future__ import annotations

import json

import httpx

from app.agents.llm_client import (
    GmiCloudClient,
    LlmMessage,
    LlmRole,
    MiniMaxClient,
    ModelPurpose,
)


async def test_minimax_complete_uses_anthropic_messages_contract() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "msg_123",
                "model": "MiniMax-M2.5",
                "content": [{"type": "text", "text": "你好"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 12, "output_tokens": 3},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(
        base_url="https://api.minimax.io/anthropic/v1/", transport=transport
    ) as http:
        client = MiniMaxClient(
            base_url="https://api.minimax.io/anthropic/v1",
            api_key="test-key",
            default_model="MiniMax-M2.5",
            client=http,
        )
        result = await client.complete(
            [
                LlmMessage(LlmRole.SYSTEM, "你是訓練客戶。"),
                LlmMessage(LlmRole.USER, "你好"),
            ],
            purpose=ModelPurpose.PERSONA,
        )

    assert seen["url"] == "https://api.minimax.io/anthropic/v1/messages"
    assert seen["headers"]["x-api-key"] == "test-key"  # type: ignore[index]
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["system"] == "你是訓練客戶。"
    assert body["messages"] == [{"role": "user", "content": "你好"}]
    assert result.text == "你好"
    assert result.usage.total_tokens == 15


async def test_minimax_stream_yields_only_text_deltas() -> None:
    stream = "\n".join(
        [
            'event: message_start',
            'data: {"type":"message_start"}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}',
            '',
            'event: message_stop',
            'data: {"type":"message_stop"}',
            '',
        ]
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/anthropic/v1/messages"
        return httpx.Response(200, content=stream, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(
        base_url="https://api.minimax.io/anthropic/v1/", transport=httpx.MockTransport(handler)
    ) as http:
        client = MiniMaxClient(
            base_url="https://api.minimax.io/anthropic/v1",
            api_key="test-key",
            default_model="MiniMax-M2.5",
            client=http,
        )
        chunks = [
            chunk
            async for chunk in client.stream(
                [LlmMessage(LlmRole.USER, "你好")], purpose=ModelPurpose.PERSONA
            )
        ]

    assert chunks == ["你", "好"]


async def test_gmi_cloud_complete_uses_openai_contract_and_reports_gmi() -> None:
    seen: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl_gmi_123",
                "model": "MiniMaxAI/MiniMax-M3",
                "choices": [
                    {"message": {"role": "assistant", "content": "你好"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(
        base_url="https://api.gmi-serving.com/v1", transport=transport
    ) as http:
        client = GmiCloudClient(
            base_url="https://api.gmi-serving.com/v1",
            api_key="gmi-test-key",
            default_model="MiniMaxAI/MiniMax-M3",
            organization_id="org_test",
            client=http,
        )
        result = await client.complete(
            [LlmMessage(LlmRole.USER, "你好")],
            purpose=ModelPurpose.PERSONA,
            schema={"type": "object", "properties": {"answer": {"type": "string"}}},
            max_tokens=500,
        )

    assert seen["url"] == "https://api.gmi-serving.com/v1/chat/completions"
    headers = seen["headers"]
    assert isinstance(headers, dict)
    assert headers["authorization"] == "Bearer gmi-test-key"
    assert headers["x-organization-id"] == "org_test"
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["model"] == "MiniMaxAI/MiniMax-M3"
    assert body["max_tokens"] == 16384
    assert body["response_format"] == {"type": "json_object"}
    assert result.provider == "gmi"
    assert result.text == "你好"
