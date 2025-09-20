# Mattermost Team Edition (Local - Docker Compose)

Este setup sobe o Mattermost Team Edition em `http://localhost:8065` usando Docker + Docker Compose, com Postgres 15 como banco de dados.

## Requisitos
- Docker e Docker Compose instalados

## Estrutura
- `docker-compose.yml`: definição dos serviços `db` (Postgres) e `app` (Mattermost)
- `data/`: dados persistentes (serão criados no primeiro `up`)
  - `data/db`: volume do Postgres
  - `data/app/*`: volumes do Mattermost (config, logs, plugins, etc.)

## Subir os serviços
Na pasta `mattermost-local`:

```bash
docker-compose up -d
# ou, se sua instalação usa o plugin compose do Docker:
docker compose up -d
```

Acesse depois de alguns instantes:
- http://localhost:8065

## Parar os serviços
```bash
docker-compose down
# ou
docker compose down
```

## Logs
```bash
docker-compose logs -f app
# ou
docker compose logs -f app
```

## Observações
- O container do Mattermost usa `MM_CONFIG=/mattermost/config/config.json`. O arquivo será criado dentro do volume `./data/app/config` na primeira execução.
- Caso encontre erro de conexão com banco na primeira inicialização, aguarde alguns segundos e tente novamente (o Postgres pode demorar a subir). Se preferir configurar via variáveis, você pode incluir no serviço `app` (não obrigatório neste setup):

```yaml
environment:
  - MM_SQLSETTINGS_DRIVERNAME=postgres
  - MM_SQLSETTINGS_DATASOURCE=postgres://mmuser:mmuser_password@db:5432/mattermost?sslmode=disable&connect_timeout=10
```

- Para resetar completamente o ambiente (remove dados):
```bash
docker-compose down -v
# ou
docker compose down -v
rm -rf data/
```

---
Com isso você terá o Mattermost Team Edition rodando localmente em `localhost:8065` para integrar com seu app Electron.
