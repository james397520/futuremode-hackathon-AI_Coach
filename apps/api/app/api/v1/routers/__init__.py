"""One module per §56 API path.

Routers are I/O adapters only: validate the payload, authorise via the §9 permission
matrix, call one service, shape the response, record the §42 audit event. No business
logic and no LLM calls live here (``docs/PROJECT_STRUCTURE.md`` §3).
"""
