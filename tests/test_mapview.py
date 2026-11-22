# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""The map's view box (mapdata.view_box): which part of the model a repair map shows."""
import importlib.util, os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meshdoctor"))


@unittest.skipUnless(importlib.util.find_spec("numpy"), "numpy is not installed (only the repair map needs it)")
class ViewBoxTest(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import mapdata
        self.np, self.view_box = np, mapdata.view_box
        self.model = np.array([[0.0, 0.0, 0.0], [1.0, 0.4, 0.3], [0.5, -0.2, 0.1]])   # wall-face centres

    def test_points_of_interest_set_the_box(self):
        lo, hi = self.view_box([[0.2, 0.1, 0.1], [0.4, 0.0, 0.2]], self.model)
        self.np.testing.assert_allclose(lo, [0.08, -0.12, -0.02])
        self.np.testing.assert_allclose(hi, [0.52, 0.22, 0.32])

    def test_one_point_of_interest_is_enough(self):
        lo, hi = self.view_box([[0.5, 0.0, 0.1]], self.model, pad=0.1)
        self.np.testing.assert_allclose(lo, [0.4, -0.1, 0.0], atol=1e-12)
        self.np.testing.assert_allclose(hi, [0.6, 0.1, 0.2])

    def test_no_defects_and_no_heat_layer_shows_the_whole_model(self):
        # It used to stop with numpy's "zero-size array to reduction operation minimum" (the public Ahmed 25 degree
        # runs have no defect clusters).
        lo, hi = self.view_box([], self.model)
        self.np.testing.assert_allclose(lo, [-0.12, -0.32, -0.12])
        self.np.testing.assert_allclose(hi, [1.12, 0.52, 0.42])


if __name__ == "__main__":
    unittest.main()
