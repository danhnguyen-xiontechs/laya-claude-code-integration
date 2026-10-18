class Order:
    objects = []

    def __init__(self, name):
        self.name = name

    @classmethod
    def get(cls, id):
        return cls.objects[int(id)]

    def __str__(self):
        return self.name

    def recalculate_legacy(self):
        return 0
