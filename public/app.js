const $ = (s) => document.querySelector(/^[#.\[]/.test(s) ? s : '#' + s);
const searchInput = $('search-input');
const statusFilter = $('status-filter');
const sectorFilter = $('sector-filter');
const sortSelect = $('sort-select');
const refreshBtn = $('refresh-btn');
const projectsGrid = $('projects-grid');
const resultCount = $('result-count');
const metaInfo = $('meta-info');
const statusBanner = $('status-banner');
const nodeBadge = $('node-badge');

let allProjects = [];

function showBanner(message, type = 'error') {
    statusBanner.textContent = message;
    statusBanner.className = `banner ${type}`;
}

function hideBanner() {
    statusBanner.className = 'banner hidden';
    statusBanner.textContent = '';
}

function  formatUsd(amount) {
    return new Intl.NumberFormat( 'en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,

    }).format(amount || 0);
}

function fillSelect(selectEl, allLabel, values) {
    const previous = selectEl.value;
    selectEl.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = allLabel;
    selectEl.appendChild(allOpt);

    values.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        selectEl.appendChild(opt);
    });

    selectEl.value = values.includes(previous) ? previous : 'ALL';
}

function populateFilters(projects) {
    const statuses = [...new Set(projects.map((p) => p.status).filter(Boolean))].sort();
    const sectors = [...new Set(projects.map((p) => p.sector).filter(Boolean))].sort();

    fillSelect(statusFilter, 'All Statuses', statuses);
    fillSelect(sectorFilter, 'All Sectors', sectors);
}

function getFilteredAndSorted() {
    const statusVal = statusFilter.value;
    const sectorVal = sectorFilter.value;
    const sortVal = sortSelect.value;

    const filtered = allProjects.filter((p) => {
        const okStatus = statusVal === 'ALL' || p.status === statusVal;
        const okSector = sectorVal === 'ALL' || p.sector === sectorVal;
        return okStatus && okSector;
    });

    return filtered.sort((a, b) => {
        switch (sortVal) {
            case 'commitment-asc':
                return a.commitmentUsd - b.commitmentUsd;
            case 'title-asc':
                return a.title.localeCompare(b.title);
            case 'commitment-desc':
                default:
                    return b.commitmentUsd - a.commitmentUsd;        
        }
    });
}

function renderProjects() {
    const items = getFilteredAndSorted();
    resultCount.textContent = `${items.length} of ${allProjects.length} projects shown`;
    projectsGrid.innerHTML = '';

    if (items.length === 0) {
        const msg = document.createElement('p');
        msg.textContent = 'No projects match your filteres. Try resetting them or searching another term.';
        projectsGrid.appendChild(msg);
        return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((p) => {
        const card = document.createElement('article');
        card.className = 'card';

        const meta = document.createElement('div');
        meta.className = 'card-meta';
        const country = document.createElement('span');
        country.textContent = p.country;
        const status = document.createElement('span');
        status.className = 'pill';
        status.textContent = p.status;
        status.textContent= p.status;
        meta.append(country, status);

        const title = document.createElement('h2');
        title.textContent = p.title;

        const sector = document.createElement('div');
        sector.className = 'card-meta';
        sector.textContent = `Sector: ${p.sector} . ID: ${p.id}`;

        const amount = document.createElement('div');
        amount.className = 'amount';
        amount.textContent = `Commitment: ${formatUsd(p.commitmentUsd)}`;

        const link = document.createElement('a');
        link.href = p.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View Project Details ->';

        card.append(meta, title, sector, amount, link);
        fragment.appendChild(card);
    });
    projectsGrid.appendChild(fragment);
}

async function fetchProjects() {
    hideBanner();
    resultCount.textContent = 'Loading projects...';
    
    let data;
    try {
        const q = encodeURIComponent(searchInput.value.trim());
        const res = await fetch(`/api/projects?q=${q}&rows=40`);
        data = await res.json();
        if (data.server) nodeBadge.textContent = `Served by: ${data.server}`;
        if (!res.ok) throw new Error (data.error || `Server returned ${res.status}`);
    } catch (err) {
        allProjects = [];
        renderProjects();
        showBanner(`Could not load projects: ${err.message}. Please try again.`, 'error');
        return;
    }

    try {
        if (data.warning) showBanner(data.warning, 'warn');
        allProjects = Array.isArray(data.projects) ? data.projects :[];
        populateFilters(allProjects);
        renderProjects();
        metaInfo.textContent = `Data mode: ${data.source} . Updated: ${new Date (
            data.fetchedAt
        ).toLocaleTimeString()}`;
    } catch (err) {
        console.error(err);
        showBanner(`Display error: ${err.message}`, 'error');
    }

}

refreshBtn.addEventListener('click', fetchProjects);
searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchProjects();
});
statusFilter.addEventListener('change', renderProjects);
sectorFilter.addEventListener('change', renderProjects);
sortSelect.addEventListener('change', renderProjects);

fetchProjects();


