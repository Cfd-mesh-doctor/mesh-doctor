// SPDX-License-Identifier: GPL-3.0-or-later
// Links and names used across the site. The repository is public; nothing here is private.

export const APP_NAME = "Mesh Doctor";
export const REPO_URL = "https://github.com/Cfd-mesh-doctor/mesh-doctor";
export const DOCS = {
  readme: `${REPO_URL}#readme`,
  quickstart: `${REPO_URL}#quickstart`,
  howItWorks: `${REPO_URL}/blob/main/docs/how-it-works.md`,
  dashboard: `${REPO_URL}/blob/main/docs/dashboard.md`,
  validation: `${REPO_URL}/blob/main/docs/validation.md`,
  gallery: `${REPO_URL}/blob/main/docs/gallery.md`,
  firstRun: `${REPO_URL}#first-run-the-motorbike-tutorial`,
  cluster: `${REPO_URL}#university-cluster-apptainer--slurm-single-node`,
  example: `${REPO_URL}/blob/main/examples/ahmed-body/README.md`,
  license: `${REPO_URL}/blob/main/LICENSE`,
};

/** Set at build time from package.json (vite.config.ts). */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
