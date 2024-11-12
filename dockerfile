FROM node:20-bookworm

WORKDIR .

COPY . ./

EXPOSE 8000

CMD node api.js
