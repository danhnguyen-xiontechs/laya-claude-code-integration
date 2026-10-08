# build_catalog.py - quet <repo>/docs/features thanh danh muc module (modules.json trong data_dir).
# Chay lai moi khi repo them hoac doi feature doc.
#   <tool python> build_catalog.py [--config path]
import argparse, json
from common import build_catalog, data_path, load_config

ap = argparse.ArgumentParser()
ap.add_argument("--config")
args = ap.parse_args()
cfg = load_config(args.config)
cat = build_catalog(cfg)
json.dump(cat, open(data_path(cfg, "modules.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(cat)} module -> {data_path(cfg, 'modules.json')}")
for k, v in cat.items():
    print(f"  {k:24} {len(v['paths'])} path, {len(v['code_files'])} file .cs | {v['description'][:90]}")
