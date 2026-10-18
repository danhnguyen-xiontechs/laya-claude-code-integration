DEFAULTS = {"plugin": "upper"}


def load(path):
    import yaml
    with open(path) as fh:
        return {**DEFAULTS, **yaml.safe_load(fh)}
