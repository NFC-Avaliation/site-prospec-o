# Prospecção Zafer

Painel para organizar contatos e preparar mensagens no WhatsApp Web.

## Publicar no GitHub Pages

1. Extraia o ZIP e envie os arquivos para a raiz do repositório. O arquivo `index.html` deve ficar na raiz.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Selecione a branch `main` e a pasta `/(root)`. Clique em **Save**.
5. Abra o endereço exibido em **Settings → Pages** após a publicação.

O painel é estático e funciona sem instalação, API ou variáveis de ambiente. Para testar localmente, execute `python -m http.server 8000` na pasta extraída e abra `http://localhost:8000`.

## Usar o painel

- Importe um CSV ou XLSX com as colunas **Nome** e **WhatsApp**. Use a primeira aba no XLSX e informe o DDD dos números brasileiros. O painel ignora números duplicados.
- **Boas-vindas** abre a conversa com uma saudação pelo horário de Brasília.
- Em **Editar mensagem**, salve seu texto e adicione fotos ou vídeos. Use `{nome}` e `{saudacao}` para personalizar o texto.
- Para enviar mídia, baixe o arquivo pelo painel e anexe na conversa do WhatsApp Web.
- Após enviar no WhatsApp Web, clique em **Marcar como enviada** para mover o contato.
- Contatos, status, texto e mídias ficam no navegador em que foram cadastrados. Importe listas e mídias diretamente pelo painel.

## Dependência incluída

O arquivo `jszip.min.js` permite ler arquivos XLSX no navegador. O cabeçalho do arquivo inclui os avisos de licença.
