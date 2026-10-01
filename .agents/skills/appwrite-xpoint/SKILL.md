---
name: appwrite-xpoint
description: Consultar e operar, quando explicitamente autorizado, os projetos Appwrite AppRemoto e Chatboot da XPoint por um MCP local com credenciais DPAPI. Exclusiva deste repositorio.
---

# Appwrite XPoint

Use o MCP `appwrite-xpoint` para dados e configuracoes Appwrite deste repositorio.

## Perfis

- `appremoto-production`: Remote Platform, endpoint customizado da XPoint e projeto `6abc5640003cb361b809`.
- `chatboot-production`: Chatboot, endpoint self-hosted HTTPS, projeto `chatboot-production`, database `chatboot_db` e bucket `chatboot_media`.

Selecione o perfil explicitamente. Nao transfira IDs, documentos ou configuracoes entre perfis por inferencia.

## Operacao

1. Comece com `list_appwrite_profiles` quando o perfil nao estiver claro.
2. Use `appwrite_get` para consultas. O caminho deve ser uma rota REST Appwrite iniciada por `/` e nunca uma URL completa.
3. Use `appwrite_mutate` somente quando o usuario pedir a alteracao externa de forma explicita. Confirme perfil, metodo, caminho e corpo; passe `confirmed: true` apenas nessa situacao.
4. Depois de uma mutacao, faca no maximo uma leitura focada para confirmar o resultado. Nao repita uma escrita perdida ou incerta antes de consultar o estado.

As respostas podem conter dados privados. Resuma somente o necessario e nunca exponha chaves, cookies, tokens ou senhas. Acesso direto HTTP sem TLS e o endpoint por IP nao sao permitidos pelo MCP.

## Configuracao local

O MCP le a chave Chatboot de `.local/appwrite-xpoint/chatboot-production-api-key.dpapi` e a chave AppRemoto do artefato DPAPI ja usado pela Remote Platform. Se uma credencial estiver ausente ou nao puder ser descriptografada pelo usuario Windows atual, interrompa sem pedir que a chave seja colada no chat.
