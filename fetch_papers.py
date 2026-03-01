import datetime
import requests
import xml.etree.ElementTree as ET
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Configurações
SEARCH_QUERY = 'all:"3D Print" AND all:DLP AND all:Resin'
EMAIL_RECIPIENT = 'marcelo.delguerra@gmail.com'
# Nota: Para e-mail, usaremos uma abordagem de log por enquanto, 
# já que não temos credenciais de SMTP reais configuradas no ambiente.
# Em um cenário real, usaríamos variáveis de ambiente para SMTP_USER e SMTP_PASS.

def fetch_arxiv_papers(query, days=7):
    base_url = 'http://export.arxiv.org/api/query?'
    # Calcular a data de início (7 dias atrás)
    date_limit = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime('%Y%m%d%H%M%S')
    
    params = {
        'search_query': query,
        'start': 0,
        'max_results': 200,
        'sortBy': 'submittedDate',
        'sortOrder': 'descending'
    }
    
    response = requests.get(base_url, params=params)
    if response.status_code != 200:
        print(f"Erro ao acessar ArXiv API: {response.status_code}")
        return []

    root = ET.fromstring(response.content)
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    
    papers = []
    seven_days_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    
    for entry in root.findall('atom:entry', ns):
        published_node = entry.find('atom:published', ns)
        if published_node is None:
            continue
        published_str = published_node.text
        published_date = datetime.datetime.strptime(published_str, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
        
        if published_date >= seven_days_ago:
            title_node = entry.find('atom:title', ns)
            title = title_node.text.strip().replace('\n', ' ') if title_node is not None else "Sem título"
            
            summary_node = entry.find('atom:summary', ns)
            summary = summary_node.text.strip().replace('\n', ' ') if summary_node is not None else "Sem resumo"
            
            link_node = entry.find('atom:id', ns)
            link = link_node.text if link_node is not None else ""
            
            authors = [author.find('atom:name', ns).text for author in entry.findall('atom:author', ns) if author.find('atom:name', ns) is not None]
            
            papers.append({
                'title': title,
                'summary': summary,
                'link': link,
                'authors': authors,
                'published': published_date.strftime('%Y-%m-%d')
            })
            
    return papers

def format_email_body(papers):
    if not papers:
        return "Nenhum artigo novo encontrado nos últimos 7 dias sobre '3D Print DLP Resin'."
    
    body = "<h2>Novos Artigos Científicos: 3D Print DLP Resin</h2>"
    body += f"<p>Período: Últimos 7 dias (até {datetime.datetime.now().strftime('%d/%m/%Y')})</p><hr>"
    
    for p in papers:
        body += f"<h3><a href='{p['link']}'>{p['title']}</a></h3>"
        body += f"<p><b>Autores:</b> {', '.join(p['authors'])}</p>"
        body += f"<p><b>Data:</b> {p['published']}</p>"
        body += f"<p><b>Resumo:</b> {p['summary'][:500]}...</p>"
        body += "<hr>"
    
    return body

def main():
    print(f"Iniciando busca de artigos para: {SEARCH_QUERY}")
    papers = fetch_arxiv_papers(SEARCH_QUERY, days=7)
    print(f"Encontrados {len(papers)} artigos.")
    
    email_content = format_email_body(papers)
    
    # Salvar resultado em um arquivo HTML para registro/debug
    output_file = f"report_{datetime.datetime.now().strftime('%Y%m%d')}.html"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(email_content)
    print(f"Relatório gerado em: {output_file}")

    # Envio de e-mail usando SMTP
    smtp_server = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
    smtp_port = int(os.getenv('SMTP_PORT', '587'))
    smtp_user = os.getenv('SMTP_USER')
    smtp_pass = os.getenv('SMTP_PASS')

    if not smtp_user or not smtp_pass:
        print(f"Credenciais SMTP não configuradas. Pulando envio para {EMAIL_RECIPIENT}.")
        return

    try:
        msg = MIMEMultipart()
        msg['From'] = smtp_user
        msg['To'] = EMAIL_RECIPIENT
        msg['Subject'] = f"Artigos Científicos Semanais: 3D Print DLP Resin ({datetime.datetime.now().strftime('%d/%m/%Y')})"
        
        msg.attach(MIMEText(email_content, 'html'))
        
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()
        print(f"E-mail enviado com sucesso para {EMAIL_RECIPIENT}!")
    except Exception as e:
        print(f"Erro ao enviar e-mail: {e}")

if __name__ == "__main__":
    main()
