/**
 * Simulation *library / setup / review / completion* pages.
 *
 * NOTE the directory name: this is `features/simulations` (plural). The live and
 * voice session experience lives in `features/simulation` (singular), which is
 * owned by a different agent — see docs/PROJECT_STRUCTURE.md §5. Nothing here
 * imports from there except the two thin route files for /live and /voice.
 */
export { SimulationLibraryPage } from './simulation-library-page';
export { SimulationSetupPage } from './simulation-setup-page';
export { SessionReviewPage } from './session-review-page';
export { SessionCompletePage } from './session-complete-page';
