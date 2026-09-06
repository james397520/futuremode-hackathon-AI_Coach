"""LLM composition root: MiniMax direct stays primary and GMI is first fallback."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from conftest import FakeLlm

from app.agents.llm_client import LlmMessage, LlmRole, ModelPurpose
from app.services import factory


async def test_build_llm_uses_gmi_as_first_minimax_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct = FakeLlm(provider="minimax", responses=["unused"], fail_times=1)
    gmi = FakeLlm(provider="gmi", responses=["由 GMI 回覆"])
    settings = SimpleNamespace(
        openai_api_key="",
        minimax_api_key="minimax-key",
        gmi_api_key="gmi-key",
        private_llm_base_url="",
        llm_provider="minimax",
    )
    monkeypatch.setattr(factory, "_settings", lambda: settings)
    monkeypatch.setattr(factory.MiniMaxClient, "from_settings", lambda: direct)
    monkeypatch.setattr(factory.GmiCloudClient, "from_settings", lambda: gmi)

    client = factory.build_llm(
        SimpleNamespace(tenant_id="tenant", workspace_id="workspace", request_id="request")
    )
    result = await client.complete(
        [LlmMessage(LlmRole.USER, "你好")], purpose=ModelPurpose.PERSONA
    )

    assert result.provider == "gmi"
    assert result.text == "由 GMI 回覆"
    assert direct.calls
    assert gmi.calls
