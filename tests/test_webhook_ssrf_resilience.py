import sys
# conftest.py and some route tests stub database/middleware modules. Clear any
# stubs that can break real core/src imports before loading webhook_manager.
for module_name in ("src.webhook_manager", "src.database", "core.middleware"):
    sys.modules.pop(module_name, None)

_core_database = sys.modules.get("core.database")
if _core_database is not None and not getattr(_core_database, "__dict__", {}).get("__file__"):
    sys.modules.pop("core.database", None)

import pytest
from src.webhook_manager import validate_webhook_url


def test_webhook_url_ssrf_mitigation():
    # SSRF bypasses that must be rejected, including IPv6 unspecified and
    # IPv4-mapped IPv6 (loopback + cloud metadata).
    private_urls = [
        "http://[::]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/",
        "http://127.0.0.1/",
        "http://0.0.0.0/",
    ]
    for url in private_urls:
        with pytest.raises(ValueError) as exc:
            validate_webhook_url(url)
        assert "private/internal addresses" in str(exc.value)

    # A clearly public IP literal must still be accepted.
    public_url = "http://93.184.216.34/"
    assert validate_webhook_url(public_url) == public_url
