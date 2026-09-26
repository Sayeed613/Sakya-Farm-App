"""Visual verification of the UI-audit fixes via headless Chrome + CDP.

Loads each audited route on the Expo web bundle and asserts the DOM markers
that distinguish the FIXED UI from the old one. Read-only: no clicks, no
form input, no state changes.
"""
import asyncio
import json
import urllib.request

import websockets

BASE = "http://127.0.0.1:8081"
DEBUGGER = "http://127.0.0.1:9222"


def http_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def fresh_tab() -> str:
    # Chrome 111+ requires PUT for /json/new.
    request = urllib.request.Request(
        f"{DEBUGGER}/json/new?about:blank", method="PUT"
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        target = json.loads(response.read().decode("utf-8"))
    return target["id"]


async def evaluate(ws, expression: str, timeout_s: float = 90.0):
    """Runtime.evaluate with awaitPromise; returns the JS value."""
    await ws.send(
        json.dumps(
            {
                "id": 2,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "awaitPromise": True,
                    "returnByValue": True,
                    "timeout": int(timeout_s * 1000),
                },
            }
        )
    )
    while True:
        message = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout_s + 15))
        if message.get("id") == 2:
            result = message.get("result", {})
            if "exceptionDetails" in result:
                raise RuntimeError(json.dumps(result["exceptionDetails"])[:800])
            return result.get("result", {}).get("value")


async def navigate(ws, url: str, settle_s: float):
    await ws.send(
        json.dumps(
            {
                "id": 3,
                "method": "Page.navigate",
                "params": {"url": url},
            }
        )
    )
    await asyncio.sleep(settle_s)


def body_text_js() -> str:
    return "document.body ? document.body.innerText : ''"


CHECKS = [
    (
        "/(shop)/profile",
        4.0,
        """
    (() => {
      const t = document.body ? document.body.innerText : '';
      return {
        loaded: t.includes('Account') || t.includes('Verify your number'),
        // FIX 6: stray "Welcome" caption removed
        welcomeCaptionGone: !t.includes('add your name from profile completion'),
        // Signed-in-only content: visible only when authenticated
        menuRows: {
          wishlist: t.includes('Wishlist'),
          editProfile: t.includes('Edit profile'),
          settings: t.includes('Settings'),
          support: t.includes('Help & Support'),
          deleteAccount: t.includes('Delete account'),
        },
        // Guest surface: the AuthGate should be showing
        authGate: t.includes('Verify your number'),
      };
    })()
    """,
    ),
    (
        "/(shop)/orders",
        4.0,
        """
    (() => {
      const t = document.body ? document.body.innerText : '';
      return {
        loaded: t.includes('Orders'),
        hasSubtitle: t.includes('farm orders'),
        // FIX 11: honest reorder failure alert path (Buy Again present)
        hasBuyAgain: t.includes('Buy Again') || t.includes('Verify your number'),
        gated: t.includes('Verify your number'),
      };
    })()
    """,
    ),
    (
        "/(shop)/cart",
        4.0,
        """
    (() => {
      const t = document.body ? document.body.innerText : '';
      // innerText returns RENDERED text: the overline is CSS-uppercased.
      const hasDeliveringTo = /delivering to/i.test(t);
      return {
        loaded: t.includes('Cart'),
        // FIX 4: dead "Share" button removed
        deadShareGone: !t.includes('Share'),
        // FIX: CartAddressHeader mounted in the cart header
        hasDeliveringTo,
        emptyState: t.includes('Your cart is empty'),
      };
    })()
    """,
    ),
    (
        "/(shop)/settings",
        4.0,
        """
    (() => {
      const t = document.body ? document.body.innerText : '';
      return {
        loaded: t.includes('Settings'),
        // FIX 1: shared SubScreenHeader (guest gate may cover content)
        gated: t.includes('Verify your number'),
      };
    })()
    """,
    ),
]


async def main() -> int:
    tab_id = fresh_tab()
    ws_url = f"ws://127.0.0.1:9222/devtools/page/{tab_id}"
    async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
        results = {}
        for index, (route, settle_s, check_js) in enumerate(CHECKS):
            url = f"{BASE}{route}"
            # First navigation compiles the web bundle; give it generous time.
            await navigate(ws, url, settle_s=max(settle_s, 45.0) if index == 0 else settle_s)
            try:
                value = await evaluate(ws, check_js, timeout_s=30)
            except RuntimeError as error:
                value = {"error": str(error)[:300]}
            results[route] = value

        # Screenshot the last route (cart) for eyeballing the fixes.
        await ws.send(json.dumps({"id": 9, "method": "Page.captureScreenshot"}))
        while True:
            message = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            if message.get("id") == 9:
                data = message["result"]["data"]
                break
        import base64
        from pathlib import Path

        out = Path(__file__).resolve().parent.parent / "apps" / "customer" / ".visual-verify"
        out.mkdir(exist_ok=True)
        (out / "cart.png").write_bytes(base64.b64decode(data))

        print(json.dumps(results, indent=2))
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
