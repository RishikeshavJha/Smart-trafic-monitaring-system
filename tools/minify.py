"""
tools/minify.py – Utility script to bundle and minify static CSS and JS assets.

Uses rcssmin and rjsmin (pure Python minifiers) or fallback minification
to output into static/dist/.
"""

import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DIST_DIR = STATIC_DIR / "dist"

def minify_css_simple(css: str) -> str:
    """Basic fallback CSS minification."""
    css = re.sub(r'/\*[\s\S]*?\*/', '', css)
    css = re.sub(r'\s+', ' ', css)
    css = re.sub(r'\s*([\{\}\:\;\,])\s*', r'\1', css)
    return css.strip()

def minify_js_simple(js: str) -> str:
    """Basic fallback JS comment stripping and whitespace trim."""
    js = re.sub(r'//.*?\n', '\n', js)
    js = re.sub(r'/\*[\s\S]*?\*/', '', js)
    return js.strip()

def run_minification():
    os.makedirs(DIST_DIR / "css", exist_ok=True)
    os.makedirs(DIST_DIR / "js", exist_ok=True)

    print("Minifying CSS files...")
    css_files = list((STATIC_DIR / "css").glob("*.css"))
    for f in css_files:
        src = f.read_text(encoding="utf-8")
        try:
            import rcssmin
            minified = rcssmin.cssmin(src)
        except ImportError:
            minified = minify_css_simple(src)
        out_file = DIST_DIR / "css" / f.name
        out_file.write_text(minified, encoding="utf-8")
        print(f"  {f.name}: {len(src)} -> {len(minified)} bytes")

    print("\nMinifying JS files...")
    js_files = list((STATIC_DIR / "js").glob("*.js"))
    for f in js_files:
        src = f.read_text(encoding="utf-8")
        try:
            import rjsmin
            minified = rjsmin.jsmin(src)
        except ImportError:
            minified = minify_js_simple(src)
        out_file = DIST_DIR / "js" / f.name
        out_file.write_text(minified, encoding="utf-8")
        print(f"  {f.name}: {len(src)} -> {len(minified)} bytes")

    print(f"\nCompleted minification to {DIST_DIR}")

if __name__ == "__main__":
    run_minification()
