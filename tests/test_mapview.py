# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""The map's view box (mapdata.view_box): which part of the model a repair map shows, and the size of its pixels
(mapdata.auto_bin)."""
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


@unittest.skipUnless(importlib.util.find_spec("numpy"), "numpy is not installed (only the repair map needs it)")
class AutoBinTest(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import mapdata
        self.np, self.m = np, mapdata

    def across(self, lo, hi, step):
        """Pixels across the side picture, as density() counts them."""
        d = self.m.density(self.np.array([[lo[0], 0.0, lo[2]]]), 0, 2, [lo[0], lo[2]], [hi[0], hi[2]], step)
        return d["nx"]

    def test_a_small_view_keeps_4_mm_pixels(self):
        self.assertEqual(self.m.auto_bin([0.0, -0.3, 0.0], [1.3, 0.3, 0.5]), 0.004)

    def test_a_whole_car_gets_coarser_pixels_and_stays_within_800_across(self):
        lo, hi = [-0.12, -1.0, -0.01], [5.12, 1.0, 1.3]   # a 5 m car with the view box's padding
        self.assertGreater(self.across(lo, hi, 0.004), 1300)   # what the fixed 4 mm gave
        step = self.m.auto_bin(lo, hi)
        self.assertEqual(step, 0.0066)
        self.assertLessEqual(self.across(lo, hi, step), 800)
        self.assertGreater(self.across(lo, hi, step), 790)   # no coarser than it needs to be

    def test_the_view_at_exactly_800_pixels_keeps_4_mm(self):
        self.assertEqual(self.m.auto_bin([0.0, 0.0, 0.0], [0.004 * 799, 0.1, 0.1]), 0.004)


if __name__ == "__main__":
    unittest.main()
