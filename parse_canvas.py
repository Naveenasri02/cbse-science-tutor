from bs4 import BeautifulSoup

with open('canvas_ref.html', 'r', encoding='utf-8') as f:
    html = f.read()

soup = BeautifulSoup(html, 'html.parser')

# Get all visible text elements with their styles
for tag in soup.find_all(['h1','h2','h3','h4','p','span','div','button','li','a','header','section']):
    text = tag.get_text(strip=True)[:120]
    if not text or len(text) < 3:
        continue
    style = tag.get('style', '')
    classes = ' '.join(tag.get('class', []))
    keywords = ['legal','teaching','employee','customer','banking','assistant','welcome','try','chat','secure','upload','matify','private','enterprise','send','message','due','contract','compliance','curriculum','lesson','exam','hr','policy','onboarding','helpdesk','product','troubleshoot','claims','guidance']
    if any(kw in text.lower() for kw in keywords):
        print(f'<{tag.name}> class="{classes}" style="{style[:150]}"')
        print(f'  Text: {text}')
        print()
