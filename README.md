# Infinito Deployer 🚀
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach) [![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach)


**🖥️ Deploy terminal. 🛒 App store. ♾️ Infinito.Nexus — made accessible.**

---

## What is Infinito Deployer? 📌

**Infinito Deployer** extends the [Infinito.Nexus](https://github.com/kevinveenbirkenbach/infinito-nexus) core infrastructure platform with a **web-based deploy terminal and application store**. It transforms the Infinito.Nexus role ecosystem into a **guided, observable, and repeatable deployment experience** — no CLI expertise required.

> This repository implements the feature tracked at [infinito-nexus/core#124](https://github.com/infinito-nexus/core/issues/124).

| 📚 | 🔗 |
|---|---|
| 🌐 Core Platform | [![Infinito.Nexus](https://img.shields.io/badge/Infinito.Nexus-Core-000000?labelColor=004B8D&style=flat)](https://infinito.nexus) |
| 🐛 Issue Tracker | [![GitHub Issues](https://img.shields.io/badge/Issues-GitHub-000000?logo=github&labelColor=004B8D&style=flat)](https://github.com/kevinveenbirkenbach/infinito-deployer/issues) |
| 🔧 Professional Setup | [![CyberMaster.Space](https://img.shields.io/badge/CyberMaster-%2ESpace-000000?labelColor=004B8D&style=flat)](https://cybermaster.space) |
| ☕️ Support Us | [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate) |

---

## Key Features 🎯

- **App Store** 🛒
  Browse and select deployable Infinito.Nexus applications as clean, visual tiles with maturity and target metadata.

- **Live Deploy Terminal** 🖥️
  Watch each deployment step in real time via a Docker-like web terminal. Cancel safely at any time. Secrets are always masked.

- **Workspace Management** 📂
  Manage inventory files (inventory.yml, host_vars, group_vars) directly in the UI — transparent and auditable.

- **Flexible Authentication** 🔑
  Deploy to any target via password or SSH key. Supports localhost, IP, or domain targets.

- **PostgreSQL-Backed State** 🗄️
  Requirements and workspace state are persisted in a local Postgres database for reliability across restarts.

- **Non-Destructive** ✅
  The CLI and Ansible remain the single source of truth. The deployer orchestrates — it never replaces the core tooling.

---

## Get Started 🚀

### Prerequisites

- Docker Engine and Docker Compose v2

### Quick Setup

```bash
git clone https://github.com/kevinveenbirkenbach/infinito-deployer
cd infinito-deployer
make setup
```

After startup:

- **Web UI:** http://localhost:3000
- **API Health:** http://localhost:8000/health

The default stack seeds the required Infinito.Nexus content from the configured image. A separate local checkout is only needed for custom job runner mounts.

The SPOT for local runtime setup, environment variables, database initialization, job runner configuration, and SSH test targets is the [Setup Guide](docs/contributing/testing/local.md).

---

## Guides 📚

- [Setup Guide](docs/contributing/testing/local.md) — full local setup, environment variables, and operational commands.
- [Makefile Reference](docs/contributing/tools/makefile.md) — all `make` targets explained.
- [Development Setup](docs/contributing/environment/setup.md) — contributor environment bootstrap.

## Contributing 🔨

For the full development setup, contribution workflow, testing, and coding standards, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security 🛡️

For security reporting and disclosure, see [SECURITY.md](SECURITY.md).

## License 📜

All rights reserved by Kevin Veen-Birkenbach — see [LICENSE](LICENSE) for details.

## Support and Contact 💼

For help, bug reports, and professional setup, see [SUPPORT.md](SUPPORT.md).
