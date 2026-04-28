-- Broaden fintech media feeds into adjacent regulated categories.
-- Official regulator sources remain required for regulated daily briefs.

update public.source_sites
set default_categories = array['Fintech','CASP/VASP','Investment']
where url = 'https://www.finextra.com/rss/headlines.aspx';

update public.source_sites
set default_categories = array['Fintech','CASP/VASP']
where url in (
  'https://www.paymentsjournal.com/feed/',
  'https://thepaypers.com/rss'
);
