class BaseCommand:
    def handle(self, *args, **options):
        raise NotImplementedError


class Command(BaseCommand):
    help = "Purge old orders"

    def handle(self, *args, **options):
        print("purging")
        # for o in old_orders():
        #     o.delete()
        return 0
