import os
import secrets
import unittest
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from flask import Flask, jsonify, request, session
from psycopg.conninfo import conninfo_to_dict

from server.hosted_workspace_store import HostedWorkspaceStore
from server.production_app import create_app


ORIGIN = "https://v3.example.test"
PASSWORD = "synthetic-v3-trial-password"


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.store = Mock()
        self.store.reserve_support.return_value = True
        self.workspace = Flask("test_workspace")
        self.workspace.config.update(SECRET_KEY=secrets.token_hex(32), SESSION_COOKIE_NAME="__Host-test-workspace")
        self.workspace.extensions["workspace_store"] = self.store

        @self.workspace.route("/api/account/<operation>", methods=["GET", "POST"])
        def account(operation):
            if operation == "callback":
                session["account_cookie"] = True
            return jsonify(operation=operation, input=request.get_json(silent=True),
                           workspace_cookie=session.get("account_cookie"))

        config = {
            "TRIAL_PASSWORD": PASSWORD, "SESSION_SECRET": secrets.token_hex(32),
            "PUBLIC_ORIGIN": ORIGIN, "FRAME_ANCESTORS": ORIGIN, "TESTING": True,
        }
        self.env = {
            "CAPSTONE_WORKSPACE_MODE": "hosted", "CAPSTONE_SUPPORT_AI_ENABLED": "1",
            "CAPSTONE_SUPPORT_AI_MODEL": "gpt-6-luna", "OPENAI_API_KEY": "synthetic-key",
        }
        patches = (
            patch.dict(os.environ, self.env, clear=True),
            patch("server.hosted_workspace.create_app", return_value=self.workspace),
            patch("server.support_assistant.call_openai", return_value={
                "status": "completed", "output": [
                    {"type": "message", "role": "assistant",
                     "content": [{"type": "output_text", "text": "Open Explorer."}]},
                ],
            }),
        )
        with patches[0], patches[1], patches[2] as self.provider:
            self.client = create_app(config, chemistry_backend=object()).test_client()

    def sign_in(self):
        self.assertEqual(self.client.post("/login", base_url=ORIGIN,
                                         headers={"Origin": ORIGIN},
                                         data={"password": PASSWORD}).status_code, 303)

    def test_account_dispatch_does_not_bypass_the_trial_gate(self):
        for operation in ("session", "login", "library"):
            self.assertEqual(self.client.get("/api/account/" + operation, base_url=ORIGIN).status_code, 401)
        returned = self.client.get("/api/account/callback", base_url=ORIGIN)
        self.assertEqual(returned.json["operation"], "callback")
        self.assertEqual(self.client.get("/api/account/library", base_url=ORIGIN).status_code, 401)
        self.sign_in()
        self.assertTrue(self.client.get("/api/account/session", base_url=ORIGIN).json["workspace_cookie"])
        body = {"action": "save_molecule", "molfile": "x\n" * 90_000}
        route = "/api/account/library"
        self.assertEqual(self.client.post(route, base_url=ORIGIN, headers={"Origin": "https://elsewhere.example"}, json=body).status_code, 403)
        self.assertEqual(self.client.post(route, base_url=ORIGIN, headers={"Origin": ORIGIN}, json=body).json["input"], body)

    def test_persistent_budget_runs_before_provider_and_image_requires_consent(self):
        self.sign_in()
        headers = {"Origin": ORIGIN, "X-Support-Request": "1"}

        def ask(**kwargs):
            return self.client.post("/api/support/ask", base_url=ORIGIN, headers=headers,
                                    json={"question": "How do I open Explorer?", "consent": True, **kwargs})

        self.assertEqual(ask(mode="image").status_code, 422)
        self.store.reserve_support.assert_not_called()
        self.provider.assert_not_called()
        self.assertEqual(ask().status_code, 200)
        self.store.reserve_support.assert_called_once_with("text")
        self.assertEqual(self.provider.call_args.args[1]["tools"], [])
        self.store.reserve_support.return_value = False
        self.assertEqual(ask().status_code, 429)
        self.assertEqual(self.provider.call_count, 1)
        self.store.reserve_support.side_effect = RuntimeError("sensitive database exception")
        self.assertEqual(ask().status_code, 503)
        self.assertEqual(self.provider.call_count, 1)


class BudgetDatabaseTests(unittest.TestCase):
    def test_reservations_are_atomic_and_shared_between_instances(self):
        dsn = os.environ.get("CAPSTONE_WORKSPACE_TEST_DSN")
        if not dsn:
            self.skipTest("Use a migrated disposable localhost database named workspace_test_budget.")
        info = conninfo_to_dict(dsn)
        self.assertEqual(info.get("host"), "127.0.0.1")
        self.assertEqual(info.get("dbname"), "workspace_test_budget")
        self.assertNotIn("hostaddr", info)
        self.assertNotIn("service", info)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = Counter(pool.map(lambda _: HostedWorkspaceStore(dsn).reserve_support("image"), range(45)))
        self.assertEqual(results, Counter({True: 40, False: 5}))
        self.assertFalse(HostedWorkspaceStore(dsn).reserve_support("text"))
