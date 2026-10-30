from pathlib import Path

import config


def test_local_env_file_is_resolved_from_backend_not_working_directory(monkeypatch):
    monkeypatch.chdir(Path(config.__file__).parent)

    assert config.LOCAL_ENV_FILE == Path(config.__file__).resolve().parents[1] / ".env.local"
