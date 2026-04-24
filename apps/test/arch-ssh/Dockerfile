FROM archlinux:latest

RUN pacman -Syu --noconfirm --needed \
    ansible-core \
    inetutils \
    openssh \
    python \
    python-pip \
    python-yaml \
    sudo \
  && useradd -m -s /bin/bash deploy \
  && echo "deploy:deploy" | chpasswd \
  && echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
  && ssh-keygen -A \
  && rm -rf /var/cache/pacman/pkg/*

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
