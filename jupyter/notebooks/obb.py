"""Query a self-hosted openbb-api from Jupyter and get pandas DataFrames back.

    import obb
    obb.endpoints("historical")                      # find datasets
    obb.params("equity/price/historical")            # see their parameters
    df = obb.get("equity/price/historical", symbol="AAPL", provider="cboe")

The server URL comes from OBB_URL (default http://host.docker.internal:6900), and the
optional Basic auth credentials from OBB_USER / OBB_PASSWORD. Provider API keys (FRED,
BLS, EIA, ...) are configured on the server, never here.
"""

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request

import pandas as pd

BASE_URL = os.environ.get("OBB_URL", "http://host.docker.internal:6900").rstrip("/")
API_PREFIX = "/api/v1/"
_openapi: dict | None = None


class OBBError(Exception):
    """The server answered with an error (bad parameters, missing provider key, ...)."""


def _request(path: str, params: dict | None = None, timeout: int = 120):
    query = urllib.parse.urlencode(
        {
            key: ",".join(map(str, value)) if isinstance(value, (list, tuple)) else value
            for key, value in (params or {}).items()
            if value is not None
        }
    )
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    user = os.environ.get("OBB_USER")
    if user:
        token = base64.b64encode(f"{user}:{os.environ.get('OBB_PASSWORD', '')}".encode())
        request.add_header("Authorization", f"Basic {token.decode()}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status == 204:
                return None
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")
        try:
            detail = json.loads(text).get("detail", text)
        except (ValueError, AttributeError):
            detail = text
        if isinstance(detail, list):
            detail = "; ".join(
                f"{'.'.join(map(str, item.get('loc', [])))}: {item.get('msg')}" for item in detail
            )
        raise OBBError(f"HTTP {error.code}: {detail}") from None
    except urllib.error.URLError as error:
        raise OBBError(f"Cannot reach the OpenBB server at {BASE_URL}: {error.reason}") from None


def to_frame(results) -> pd.DataFrame:
    """Turn OBBject results (records, a single record, parallel lists or scalars) into a DataFrame."""
    if results is None:
        return pd.DataFrame()
    if isinstance(results, dict):
        if results and all(isinstance(value, list) for value in results.values()):
            return pd.DataFrame(results)
        return pd.json_normalize(results, max_level=1)
    if isinstance(results, list):
        if results and not isinstance(results[0], dict):
            return pd.DataFrame({"value": results})
        frame = pd.json_normalize(results, max_level=1)
        for column in ("date", "datetime", "timestamp"):
            if column in frame.columns:
                try:
                    frame[column] = pd.to_datetime(frame[column])
                except (ValueError, TypeError):
                    pass
        return frame
    return pd.DataFrame({"value": [results]})


def get(route: str, provider: str | None = None, **params) -> pd.DataFrame:
    """Fetch any endpoint, e.g. get("index/price/historical", symbol="SPX", provider="cboe")."""
    route = route.strip("/").removeprefix("api/v1/")
    data = _request(f"{API_PREFIX}{route}", {**params, "provider": provider})
    if data is None:
        print("No data for these parameters (HTTP 204).")
        return pd.DataFrame()
    if isinstance(data, dict) and "results" in data:
        for warning in data.get("warnings") or []:
            print("warning:", warning.get("message"))
        return to_frame(data["results"])
    return to_frame(data)


def _load_openapi() -> dict:
    global _openapi
    if _openapi is None:
        _openapi = _request("/openapi.json")
    return _openapi


def _providers_of(parameters: list[dict]) -> list[str]:
    for parameter in parameters:
        if parameter.get("name") == "provider":
            schema = parameter.get("schema", {})
            if "enum" in schema:
                return [str(value) for value in schema["enum"]]
            if "const" in schema:
                return [str(schema["const"])]
    return []


def endpoints(text: str = "") -> pd.DataFrame:
    """List the server's endpoints, optionally filtered by text in the route or summary."""
    rows = []
    for path, operations in _load_openapi()["paths"].items():
        if not path.startswith(API_PREFIX) or path.startswith(f"{API_PREFIX}coverage"):
            continue
        for method, operation in operations.items():
            parameters = [p for p in operation.get("parameters", []) if p.get("in") == "query"]
            rows.append(
                {
                    "route": path[len(API_PREFIX):],
                    "method": method.upper(),
                    "summary": (operation.get("summary") or "").strip(),
                    "providers": ", ".join(_providers_of(parameters)),
                    "required": ", ".join(
                        p["name"] for p in parameters if p.get("required") and p["name"] != "provider"
                    ),
                }
            )
    frame = pd.DataFrame(rows)
    if text:
        mask = frame["route"].str.contains(text, case=False) | frame["summary"].str.contains(
            text, case=False
        )
        frame = frame[mask]
    return frame.sort_values("route").reset_index(drop=True)


def params(route: str) -> pd.DataFrame:
    """Show the query parameters of one endpoint (GET)."""
    route = route.strip("/").removeprefix("api/v1/")
    operation = _load_openapi()["paths"][f"{API_PREFIX}{route}"].get("get", {})
    rows = []
    for parameter in operation.get("parameters", []):
        if parameter.get("in") != "query" or parameter["name"] == "chart":
            continue
        schema = parameter.get("schema", {})
        choices = schema.get("enum") or next(
            (option["enum"] for option in schema.get("anyOf", []) if "enum" in option), None
        )
        rows.append(
            {
                "name": parameter["name"],
                "required": parameter.get("required", False),
                "default": schema.get("default"),
                "choices": ", ".join(map(str, choices)) if choices else "",
                "description": (parameter.get("description") or schema.get("description") or "")[:200],
            }
        )
    return pd.DataFrame(rows)


def providers() -> pd.DataFrame:
    """Providers installed on the server and how many endpoints each serves."""
    coverage = _request(f"{API_PREFIX}coverage/providers") or {}
    return (
        pd.DataFrame({"provider": list(coverage), "endpoints": [len(v) for v in coverage.values()]})
        .sort_values("endpoints", ascending=False)
        .reset_index(drop=True)
    )
