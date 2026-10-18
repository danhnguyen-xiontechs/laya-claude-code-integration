class BaseExporter:
    def export(self, order):
        raise NotImplementedError


class CsvExporter(BaseExporter):
    def export(self, order):
        return ",".join(str(p * q) for p, q in order.items)
