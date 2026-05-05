"""Workspaces routes — split across submodules but exposed as one package.

`main.py` owns the `router`, `_svc`, and `_require_workspace` symbols.
`history_routes.py` and `management_routes.py` add their routes onto
that same router via side-effect imports.

External callers keep using `from .workspaces import router as
workspaces_router`; this package re-exports `router` from `main` and
imports the route-registration submodules so loading the package is
enough to register every endpoint.
"""

# Re-export the surface that route side-effect modules and unit
# tests historically reached for via `api.routes.workspaces.<X>`
# (e.g. `patch("api.routes.workspaces.ensure_workspace_access")`).
from .main import (  # noqa: F401
    router,
    _svc,
    _require_workspace,
    _roles,
    ensure_workspace_access,
)

# Side-effect imports: importing these modules attaches their
# route handlers to `router`. Order matters only insofar as both
# need `main` to be already imported.
from . import history_routes as _history_routes  # noqa: F401
from . import management_routes as _management_routes  # noqa: F401
