REGISTRY = {}


def register(model):
    def deco(cls):
        REGISTRY[model] = cls
        return cls
    return deco


@register("Order")
class OrderAdmin:
    list_display = ("name",)

    def get_queryset(self):
        return []
