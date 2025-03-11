function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function extractSchedule() {
    try {
        const rows = document.querySelectorAll('.assessment_schedule tbody tr');
        if (rows.length === 0) {
            return { error: "Error: No schedule data found." };
        }

        const csvData = [];
        
        const headers = Array.from(document.querySelectorAll('.assessment_schedule thead th'))
            .map(th => th.innerText.trim().replace(/,/g, ' '));
        csvData.push(headers.join(','));

        rows.forEach(row => {
            const cols = row.querySelectorAll('td');
            const rowData = Array.from(cols).map(col => col.innerText.trim().replace(/,/g, ' '));
            if (rowData.length > 0) {
                csvData.push(rowData.join(','));
            }
        });

        const csv = csvData.join('\n');
        downloadCSV(csv, `schedule.csv`); 

        if (csvData.length === 1) { // If only headers, no data
            return { error: "Error: No valid schedule data extracted." };
        }

        chrome.runtime.sendMessage({ action: "scheduleData", data: csvData });

        console.log("Schedule data extracted and sent to popup:", csvData);
        return { status: "completed", data: csvData };
    } catch (error) {
        console.error("Error extracting schedule data:", error);
        return { error: "Error: Failed to extract schedule data." };
    }
}

function extractScheduleForSchedinator() {
    try {
        const rows = document.querySelectorAll('.assessment_schedule tbody tr');
        if (rows.length === 0) {
            return { error: "Error: No schedule data found." };
        }

        // First, get the data in CSV format similar to what the site expects
        const entries = [];
        const uniqueDays = new Set();
        let earliestTime = null;
        let latestTime = null;

        // Process each row
        rows.forEach((row, rowIndex) => {
            try {
                const cols = row.querySelectorAll('td');
                if (cols.length >= 6) {
                    const courseData = {
                        Courses: cols[0].innerText.trim(),
                        Title: cols[1].innerText.trim().replace(/,/g, ' '),
                        Section: cols[2].innerText.trim(),
                        Units: cols[3].innerText.trim(),
                        Days: cols[4].innerText.trim(),
                        Time: cols[5].innerText.trim(),
                        Room: cols[6] ? cols[6].innerText.trim() : 'TBA'
                    };

                    // Skip if it's a total units row
                    if (courseData.Title.toUpperCase().startsWith('TOTAL UNITS')) {
                        return;
                    }

                    // Split multiple days and times
                    const days = courseData.Days.split('/').map(d => d.trim()).filter(Boolean);
                    const times = courseData.Time.split('/').map(t => {
                        // Ensure time is in HH:mm:ss format
                        const [start, end] = t.trim().split('-').map(time => {
                            const [hours, minutes] = time.trim().split(':');
                            return `${hours.padStart(2, '0')}:${minutes || '00'}:00`;
                        });
                        return `${start}-${end}`;
                    }).filter(Boolean);
                    const rooms = courseData.Room.split('/').map(r => r.trim()).filter(Boolean);

                    if (days.length === 0 || times.length === 0) {
                        console.warn('Skipping row with empty days or times:', courseData);
                        return;
                    }

                    // Process each day-time-room combination
                    days.forEach((day, index) => {
                        const time = times[index] || times[0];
                        const room = rooms[index] || rooms[0];

                        try {
                            // Parse time
                            const [startStr, endStr] = time.split('-');
                            const baseDate = new Date();
                            const start = new Date(`${baseDate.toDateString()} ${startStr}`);
                            const end = new Date(`${baseDate.toDateString()} ${endStr}`);
                            const duration = (end.getTime() - start.getTime()) / (1000 * 60);

                            if (duration <= 0) {
                                console.warn(`Skipping invalid duration for entry: ${courseData.Courses} - ${time}`);
                                return;
                            }

                            // Update earliest and latest times
                            if (!earliestTime || start < earliestTime) earliestTime = start;
                            if (!latestTime || end > latestTime) latestTime = end;

                            // Add day to unique days set
                            uniqueDays.add(day);

                            // Create schedule entry
                            entries.push({
                                courseCode: courseData.Courses,
                                title: courseData.Title,
                                section: courseData.Section,
                                units: parseFloat(courseData.Units) || 0,
                                day,
                                startTime: start.toISOString(),
                                endTime: end.toISOString(),
                                duration,
                                room
                            });
                        } catch (timeError) {
                            console.error(`Error processing time for row ${rowIndex}:`, { time, error: timeError });
                        }
                    });
                }
            } catch (rowError) {
                console.error(`Error processing row ${rowIndex}:`, rowError);
            }
        });

        if (entries.length === 0) {
            return { error: "No valid schedule entries could be processed." };
        }

        // Sort days in the correct order
        const dayOrder = ['M', 'T', 'W', 'TH', 'F', 'S', 'U'];
        const sortedDays = Array.from(uniqueDays)
            .filter(day => entries.some(entry => entry.day === day))
            .sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

        // Generate time slots every 30 minutes
        const timeSlots = [];
        if (earliestTime && latestTime) {
            let currentSlot = new Date(earliestTime);
            while (currentSlot <= latestTime) {
                timeSlots.push(currentSlot.toISOString());
                currentSlot = new Date(currentSlot.getTime() + 30 * 60000);
            }
        }

        const scheduleData = {
            entries,
            metadata: {
                days: sortedDays,
                startTime: earliestTime?.toISOString(),
                endTime: latestTime?.toISOString(),
                timeSlots
            }
        };

        console.log('Final processed data:', scheduleData);
        return { status: "completed", data: scheduleData };
    } catch (error) {
        console.error("Error extracting schedule data for Schedinator:", error);
        return { error: "Error: Failed to extract schedule data - " + error.message };
    }
}

// Calculate GWA
function calculateGWA() {
    try {
        const table = document.querySelector('.table');
        const rows = table.querySelectorAll('tbody tr');
        let totalUnitsMidterm = 0;
        let totalWeightedMidterm = 0;
        let totalUnitsFinal = 0;
        let totalWeightedFinal = 0;

        rows.forEach(row => {
            if (row.cells && row.cells.length >= 6) {
                const units = parseFloat(row.cells[3].innerText);
                const midtermGrade = parseFloat(row.cells[4].innerText);
                const finalGrade = parseFloat(row.cells[5].innerText);

                if (!isNaN(units) && !isNaN(midtermGrade)) {
                    totalUnitsMidterm += units;
                    totalWeightedMidterm += units * midtermGrade;
                }

                if (!isNaN(units) && !isNaN(finalGrade)) {
                    totalUnitsFinal += units;
                    totalWeightedFinal += units * finalGrade;
                }
            }
        });

        const midtermGWA = (totalWeightedMidterm / totalUnitsMidterm).toFixed(2);
        const finalGWA = (totalWeightedFinal / totalUnitsFinal).toFixed(2);

        // Remove existing GWA row (well if it exists)
        const existingGWARow = table.querySelector('.gwa-row');
        if (existingGWARow) {
            existingGWARow.remove();
        }

        // Create and insert GWA row
        const gwaRow = document.createElement('tr');
        gwaRow.className = 'gwa-row';
        gwaRow.style.backgroundColor = '#f3f4f6';
        gwaRow.style.fontWeight = 'bold';
        gwaRow.innerHTML = `
            <td colspan="3" style="text-align: right; padding: 8px;">General Weighted Average (GWA):</td>
            <td style="text-align: center; padding: 8px;">${totalUnitsMidterm}</td>
            <td style="text-align: center; padding: 8px;">${midtermGWA}</td>
            <td style="text-align: center; padding: 8px;">${finalGWA}</td>
        `;

        const tbody = table.querySelector('tbody');
        const lastContentRow = tbody.lastElementChild;
        tbody.insertBefore(gwaRow, lastContentRow);

        return { midtermGWA, finalGWA };
    } catch (error) {
        console.error('Error calculating GWA:', error);
        return { error: 'Failed to calculate GWA' };
    }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.action === "extractSchedule") {
            const scheduleData = extractSchedule();
            sendResponse({ status: "completed", scheduleData });
        } 
        else if (request.action === "calculateGWA") {
            const result = calculateGWA();
            sendResponse(result);
        }
        else if (request.action === "extractScheduleForSchedinator") {
            const result = extractScheduleForSchedinator();
            sendResponse(result);
        }
        return true;
    }
);
