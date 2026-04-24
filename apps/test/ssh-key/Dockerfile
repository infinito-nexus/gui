FROM archlinux:latest

RUN pacman -Syu --noconfirm --needed \
    inetutils \
    openssh \
    sudo \
  && useradd -m -s /bin/bash deploy \
  && mkdir -p /home/deploy/.ssh \
  && chmod 700 /home/deploy/.ssh \
  && ssh-keygen -A \
  && printf "\nPermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes\nChallengeResponseAuthentication no\nUsePAM no\n" >> /etc/ssh/sshd_config \
  && rm -rf /var/cache/pacman/pkg/*

COPY authorized_keys /home/deploy/.ssh/authorized_keys
RUN chown -R deploy:deploy /home/deploy/.ssh \
  && chmod 600 /home/deploy/.ssh/authorized_keys

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
CMD ["/entrypoint.sh"]
