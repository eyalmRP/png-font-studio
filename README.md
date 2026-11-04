# PNG Font Studio

Turn glyph sheets from an AI image tool into PNG fonts, then design, animate and export titles with them
(PNG, GIF, WebM, MP4, MOV, animated PNG/WebP, PNG sequences, After Effects compositions). English and Hebrew.

**Use it:** https://eyalmrp.github.io/png-font-studio/ · **Guide with videos:** https://eyalmrp.github.io/png-font-studio/guide/

Your work is kept in the browser you use it in. To move a title to another browser or computer, use
**Save title** there and **Open title** here.

## Develop

```sh
npm install
npm test
npm run build      # dist/site (the web page), dist/artifact (claude.ai), dist/png-font-studio.html (one file, offline)
```

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/pages.yml`.
The guide's videos are recorded from the app itself: see `scripts/guide/README.md`.
