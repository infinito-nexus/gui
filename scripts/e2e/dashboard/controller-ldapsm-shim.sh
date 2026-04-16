#!/bin/sh
# Controller-side shim for Ansible's command_path lookup of 'ldapsm'.
# The lookup resolves the path on the Ansible controller (nexus runner image)
# and then ships that path into a `command:` task that runs on the target.
# The target host has the real `ldapsm` installed by sys-pip-install, so the
# shim only needs to exist at /usr/bin/ldapsm with +x on the controller for
# `shutil.which('ldapsm')` to succeed. It is never actually executed.
exit 0
