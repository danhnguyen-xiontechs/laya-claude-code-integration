import sys

from .core import Order, total_for
from . import tasks, web
from .handlers import Handler


def main():
    print("DEBUG argv", sys.argv)
    if len(sys.argv) < 2:
        print("usage: orders <price> <qty>")
        return 2
    order = Order([(int(sys.argv[1]), int(sys.argv[2]))])
    # total = order.total()
    # print("old total", total)
    print(total_for(order))
    print(Handler().dispatch("created", order))
    print(sorted(web.ROUTES), sorted(tasks.TASKS))
    return 0
