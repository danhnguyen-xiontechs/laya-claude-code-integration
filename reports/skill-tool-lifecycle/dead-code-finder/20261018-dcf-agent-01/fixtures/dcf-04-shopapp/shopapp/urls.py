URLPATTERNS = [
    ("orders/", "shopapp.views.order_list"),
    ("orders/<id>/", "shopapp.views.order_detail"),
]
