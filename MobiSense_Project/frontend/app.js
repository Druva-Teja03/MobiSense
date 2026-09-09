fetch('https://washed-slapping-cloning.ngrok-free.dev/issues', {
  headers: {
    'ngrok-skip-browser-warning': 'true'
  }
})
.then(response => response.json())
.then(data => {
  const sidebar = document.getElementById('sidebar');

  // Clear out the old hardcoded cards, but keep the heading
  sidebar.innerHTML = '<h2>Detected Issues</h2>';

  data.forEach(issue => {
    const card = document.createElement('div');
    card.className = 'issue-card';

    let detailsHtml = '';
    if (issue.item_count !== undefined || issue.severity) {
      const parts = [];
      if (issue.item_count !== undefined && issue.item_count !== null && issue.item_count !== '') {
        const count = Number(issue.item_count);
        parts.push(`${count} item${count === 1 ? '' : 's'} detected`);
      }
      if (issue.severity) {
        const sevStr = String(issue.severity).trim();
        const capitalized = sevStr.charAt(0).toUpperCase() + sevStr.slice(1).toLowerCase();
        parts.push(`${capitalized} severity`);
      }
      if (parts.length > 0) {
        detailsHtml = `<p class="issue-details" style="font-size: 13px; color: #6d28d9; font-weight: 600; margin-bottom: 4px;">${parts.join(' · ')}</p>`;
      }
    } else if (issue.vehicle_count !== undefined || issue.traffic_level) {
      const parts = [];
      if (issue.vehicle_count !== undefined) {
        parts.push(`${issue.vehicle_count} vehicles detected`);
      }
      if (issue.traffic_level) {
        parts.push(issue.traffic_level);
      }
      if (parts.length > 0) {
        detailsHtml = `<p class="issue-details" style="font-size: 13px; color: #1d4ed8; font-weight: 600; margin-bottom: 4px;">${parts.join(' · ')}</p>`;
      }
    }

    card.innerHTML = `
      <p class="issue-type">${issue.type}</p>
      ${detailsHtml}
      <p class="issue-location">Lat: ${issue.lat}, Lng: ${issue.lng}</p>
      <p class="issue-status">Status: ${issue.status}</p>
    `;

    sidebar.appendChild(card);
  });
})
.catch(error => {
  console.error('Error fetching issues:', error);
});