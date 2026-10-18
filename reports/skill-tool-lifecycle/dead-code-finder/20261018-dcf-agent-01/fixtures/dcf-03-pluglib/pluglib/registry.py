_PLUGINS = {}


class Plugin:
    name = None

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        if cls.name:
            _PLUGINS[cls.name] = cls

    def run(self, data):
        raise NotImplementedError


def get_plugin(name):
    return _PLUGINS[name]()


def available():
    return sorted(_PLUGINS)


def unregister(name):
    _PLUGINS.pop(name, None)
