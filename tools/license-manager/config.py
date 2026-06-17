import json
from dataclasses import dataclass
from pathlib import Path


CONFIG_DIR = Path.home() / ".timeflow-admin"
CONFIG_FILE = CONFIG_DIR / "config.json"


@dataclass
class AppConfig:
    server_url: str = ""
    admin_token: str = ""

    def is_configured(self) -> bool:
        return bool(self.server_url and self.admin_token)

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(
            json.dumps(
                {"server_url": self.server_url, "admin_token": self.admin_token},
                indent=2,
            ),
            encoding="utf-8",
        )

    @classmethod
    def load(cls) -> "AppConfig":
        if not CONFIG_FILE.exists():
            return cls()
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return cls(
                server_url=data.get("server_url", ""),
                admin_token=data.get("admin_token", ""),
            )
        except (json.JSONDecodeError, KeyError):
            return cls()
