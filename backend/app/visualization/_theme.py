"""
Tema Plotly bersama untuk semua modul visualization.

Sebelumnya tiap modul (signal_plots, feature_plots, comparison_plots) punya
salinan identik dari _base_layout + konstanta template/warna, dengan tema
"plotly_dark" + font terang (#E2E8F0) — kontras dengan app yang bertema
terang (lihat palet UI di CLAUDE.md: bg #FAFAFD, text #122056). Hasilnya
teks/gridline chart nyaris tak terbaca di card putih. Disatukan di sini dan
diselaraskan ke tema terang.
"""

PLOT_TEMPLATE = "plotly_white"
PLOT_BG = "rgba(0,0,0,0)"
PLOT_PAPER_BG = "rgba(0,0,0,0)"
PLOT_FONT_COLOR = "#122056"
PLOT_GRID_COLOR = "#E2E8F0"


def base_layout(**kwargs):
    """Merge layout defaults untuk semua chart."""
    base = dict(
        template=PLOT_TEMPLATE,
        plot_bgcolor=PLOT_BG,
        paper_bgcolor=PLOT_PAPER_BG,
        font=dict(family="Inter, sans-serif", color=PLOT_FONT_COLOR),
        margin=dict(l=50, r=20, t=44, b=40),
    )
    base.update(kwargs)
    return base
