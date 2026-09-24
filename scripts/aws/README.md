# Update da instância na AWS

Script de update da **nossa** instância Nodyx em produção (servidor AWS), como
`scripts/wsl-local/` é do servidor de teste em WSL. Fica nesta pasta própria de
propósito: `scripts/ops/` é do servidor multi-app do autor upstream
(`nodyx.org`, `demo.nodyx.org`, o hub, em `/var/www/nexus`), e mexer lá geraria
conflito a cada merge de `Pokled:main`.

## Primeira vez (ovo e galinha)

Este script chega ao servidor **pelo próprio git pull que ele faz** — ou seja,
na primeira vez ele ainda não existe em `/opt/nodyx`. Ele não depende de onde
está (usa `NODYX_DIR=/opt/nodyx`), então basta copiá-lo e rodar de fora:

```bash
# na sua máquina
scp scripts/aws/update.sh <servidor>:/tmp/

# no servidor
sudo bash /tmp/update.sh --dry-run   # confere o ramo e o que mudaria
sudo bash /tmp/update.sh             # atualiza (e traz o script pra /opt/nodyx)
```

Depois disso, para `sudo nodyx-update` (o comando que o `install.sh` deixou em
`/usr/local/bin`) passar a usar este script em vez da versão fraca gerada na
instalação — que faz `git pull` como root, roda `npm ci` sempre e não faz
backup nem verificação:

```bash
sudo bash /opt/nodyx/scripts/aws/update.sh --instalar-comando
sudo nodyx-update --dry-run
```

O original é guardado em `/usr/local/bin/nodyx-update.install-sh-<data>`, e o
que fica no lugar é só um atalho de duas linhas para o script versionado — logo
as melhorias futuras chegam por git, sem reinstalar nada.

## Uso

```bash
# no servidor, como root
sudo nodyx-update                                          # depois de --instalar-comando
sudo bash /opt/nodyx/scripts/aws/update.sh                 # equivalente, sempre funciona

sudo bash /opt/nodyx/scripts/aws/update.sh --dry-run       # só mostra o que mudaria
sudo bash /opt/nodyx/scripts/aws/update.sh --ramo main     # ramo explícito
sudo bash /opt/nodyx/scripts/aws/update.sh --sem-backup    # pula o dump (não recomendado)
```

O que ele faz, em ordem: confere os pré-requisitos, busca o remoto, exige
**fast-forward**, faz backup do banco **se houver migration nova**, puxa o
código, rebuilda só o que mudou, sincroniza a CSP do Caddy, reinicia o PM2 e
**confere** que os dois serviços responderam.

> **Se você é o Claude abrindo este projeto noutra máquina:** o cabeçalho de
> `update.sh` tem um recado com o estado das correções, o que **não** deve ser
> "consertado" por iniciativa própria (o envio de DM está quebrado de propósito,
> esperando o upstream) e as pendências abertas. Sessões são locais por máquina,
> então o git é o único canal que carrega esse contexto.

## Os três detalhes de config

Estes são os motivos de rodar os comandos na mão não funcionar. Estão tratados
no script, e valem quando você for fazer qualquer coisa à mão no servidor:

1. **git recusa o repo** — `/opt/nodyx` pertence a `nodyx`, você está como root.
   Desde o git 2.35.2 isso é *dubious ownership*. Todo comando git precisa de
   `-c safe.directory='*'`, e o pull deve rodar **como `nodyx`**, senão os
   arquivos novos nascem de root e o update seguinte não consegue escrever
   neles.

2. **PM2 é por usuário** — `pm2 restart` como root fala com o daemon do root,
   que não conhece `nodyx-core` nem `nodyx-frontend`. O comando "funciona" e não
   reinicia nada. O correto é sempre:
   ```bash
   sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 <cmd>
   ```

3. **O build do frontend estoura o heap** — SvelteKit + Vite (4500+ módulos)
   passa de 1 GB. Numa t3.micro/small o `npm run build` morre por OOM sem dizer
   por quê. Precisa de `NODE_OPTIONS=--max-old-space-size=...` escalado pela RAM
   (o script faz isso igual ao `install.sh`) e de swap ativa em máquina de 1 GB.

## Duas coisas que o `git pull` não resolve sozinho

**A CSP do Caddy.** O `install.sh` só escreve `/etc/caddy/Caddyfile` numa
(re)instalação. Uma correção de cabeçalho que chega por git **não alcança o
Caddy**. E a política posta pelo proxy *substitui* a que a aplicação declara em
`svelte.config.js` — foi assim que as fontes dos apelidos pararam de carregar
(`style-src` sem `fonts.googleapis.com`, `font-src` sem `fonts.gstatic.com`: a
folha de estilo era recusada e nenhuma fonte aparecia, nem no preview do
editor). O script detecta, corrige por diretiva, valida com `caddy validate`,
recarrega e por fim **lê a CSP que o domínio realmente serve** — o arquivo no
disco não prova o que o proxy entrega.

**As migrations.** Não há comando separado: `runMigrations()` roda no boot do
`nodyx-core` (`nodyx-core/src/index.ts`). Elas são aplicadas no restart do PM2,
na etapa 6 — e é por isso que o backup vem antes, na 2. Migration não volta com
`git reset`.

## Se falhar

O script imprime a etapa que falhou, o comando de log e o `git reset` para o
commit anterior. Lembrando que o reset volta o **código**, não o banco: se as
migrations já rodaram, é o backup da etapa 2 que importa.

```bash
sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 60 --nostream
```
