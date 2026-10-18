import pytest


@pytest.fixture
def plugin_names():
    from pluglib import available
    return available()


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: slow plugin test")
