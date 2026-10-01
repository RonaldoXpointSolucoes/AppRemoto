# AppRemoto

## Leitura obrigatoria

Antes de analisar, planejar ou alterar este projeto, leia
`DOCUMENTACAO_TECNICA_DO_APP.md`. Use as fontes canonicas indicadas nesse
documento e diferencie codigo implementado, infraestrutura implantada,
evidencia historica e funcionalidade apenas planejada.

Nao crie colecoes, campos, servicos ou credenciais por conveniencia. Primeiro
confirme se a responsabilidade ja existe no schema, nos contratos ou nos
servicos atuais. Segredos e respostas privadas permanecem em `.local/`, fora
do Git, e nunca devem ser copiados para codigo, documentacao, cards ou chat.

## Comando fila dev

Neste projeto, quando o usuario solicitar `fila dev`, `Fila dev`, `/fila dev`
ou a execucao da fila do quadro App Acesso Remoto, leia e execute
`.agents/skills/fila-dev-app-acesso-remoto/SKILL.md`.

A skill e exclusiva deste projeto e do quadro
`64ea89ca-c413-49eb-be7f-80349620b92c`. Somente cards com
`status=development` podem ser implementados. Cards em analise e nas demais
colunas sao apenas consultaveis. Entregas concluidas e verificadas seguem para
`testing`, com relatorio tecnico.

Credenciais e respostas privadas ficam em `.local/fila-dev/`, fora do Git. Nao
copie chaves para codigo, mensagens ou documentacao. Pedidos de consulta,
listagem ou teste de acesso limitam a execucao a leitura, salvo solicitacao
explicita de processar os cards.
