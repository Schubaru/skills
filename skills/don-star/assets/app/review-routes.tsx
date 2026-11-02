// The board's routes, as one fragment: spread into the app's <Routes> tree
// (`{reviewRoutes}`) — react-router flattens a fragment into its parent, so this
// is one line in App.tsx and every board surface stays out of the app's own
// bundle (each page is lazy).
import { Suspense, lazy } from "react";
import { Route } from "react-router-dom";

const Review = lazy(() => import("./pages/Review"));
const Projects = lazy(() => import("./pages/Projects"));
const Flows = lazy(() => import("./pages/Flows"));
const ProjectAccess = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectAccess })));
const ProjectAccessProject = lazy(() =>
  import("./pages/Projects").then((m) => ({ default: m.ProjectAccessProject })),
);
const ProjectAccessFolder = lazy(() =>
  import("./pages/Projects").then((m) => ({ default: m.ProjectAccessFolder })),
);
const ProjectAccessUser = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectAccessUser })));

const lazily = (node: React.ReactNode) => <Suspense fallback={null}>{node}</Suspense>;

export const reviewRoutes = (
  <>
    <Route path="/review" element={lazily(<Review />)} />
    <Route path="/projects" element={lazily(<Projects />)} />
    <Route path="/flows" element={lazily(<Flows />)} />
    <Route path="/projects/access" element={lazily(<ProjectAccess />)} />
    <Route path="/projects/access/p/:slug" element={lazily(<ProjectAccessProject />)} />
    <Route path="/projects/access/f/:id" element={lazily(<ProjectAccessFolder />)} />
    <Route path="/projects/access/u/:id" element={lazily(<ProjectAccessUser />)} />
  </>
);
