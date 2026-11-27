import directoryLayout from "./directory-layout.mjs";
import noManualRuntimePath from "./no-manual-runtime-path.mjs";
import preloadNoSharedImport from "./preload-no-shared-import.mjs";
import noDirectDatabaseImport from "./no-direct-database-import.mjs";
import noArbitraryDuration from "./no-arbitrary-duration.mjs";
import noModuleStateInUtils from "./no-module-state-in-utils.mjs";
import pagePadding from "./page-padding.mjs";
import reactComponentBoundaries from "./react-component-boundaries.mjs";

export default {
    rules: {
        "directory-layout": directoryLayout,
        "no-manual-runtime-path": noManualRuntimePath,
        "preload-no-shared-import": preloadNoSharedImport,
        "no-direct-database-import": noDirectDatabaseImport,
        "no-arbitrary-duration": noArbitraryDuration,
        "no-module-state-in-utils": noModuleStateInUtils,
        "page-padding": pagePadding,
        "react-component-boundaries": reactComponentBoundaries,
    },
};
