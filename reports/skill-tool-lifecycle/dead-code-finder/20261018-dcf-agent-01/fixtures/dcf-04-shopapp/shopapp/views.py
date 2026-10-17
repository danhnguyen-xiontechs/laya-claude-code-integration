from .models import Order


def order_list(request):
    return [o.name for o in Order.objects]


def order_detail(request, id):
    return Order.get(id)


def order_export(request):
    return "csv"
