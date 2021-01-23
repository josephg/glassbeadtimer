// This is a simple script to convert all the SVGs into a JSON document we can
// use to embed the topics on the page

const fs = require('fs');
const path = require('path')

const PATH = 'topic-svgs'

const out = {}

;(async () => {
  const dir = await fs.promises.opendir(PATH)
  for await (const dirent of dir) {
    const name = path.parse(dirent.name).name
    // console.log(dirent.name, name);
    let content = fs.readFileSync(`${PATH}/${dirent.name}`, 'utf-8')

    // content = content.replace('#fff', '#000')
    content = content.replace('#fff', 'var(--bg-color)')
    content = content.replace('#231f20', '#fff')
    // console.log(content)

    out[name] = content
  }
  console.log(JSON.stringify(out, null, 2))

  fs.writeFileSync('src/topicicons.json', JSON.stringify(out, null, 2))
})()
