import importlib
import sys

if __name__ == "__main__":
    mod = importlib.import_module(f"shopapp.management.commands.{sys.argv[1]}")
    mod.Command().handle()
