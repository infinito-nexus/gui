from fastapi import APIRouter

from .bundles import router as bundles_router
from .deployments import router as deployments_router
from .inventories import router as inventories_router
from .pricing import router as pricing_router
from .providers import router as providers_router
from .roles import router as roles_router
from .server_requirements import router as server_requirements_router
from .users import router as users_router
from .workspaces import router as workspaces_router

router = APIRouter()
router.include_router(roles_router)
router.include_router(bundles_router)
router.include_router(inventories_router)
router.include_router(deployments_router)
router.include_router(workspaces_router)
router.include_router(server_requirements_router)
router.include_router(pricing_router)
router.include_router(providers_router)
router.include_router(users_router)
