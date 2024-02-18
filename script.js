function search() {
    var searchInput = document.getElementById("search-input").value;
    var searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(searchInput);
    window.location.href = searchUrl;
}

document.getElementById("search-input").addEventListener("keydown", function(event) {
    if (event.keyCode === 13) {
        event.preventDefault();
        search();
    }
});
